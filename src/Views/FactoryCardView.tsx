import React from 'react';
import '../css/FactoryCardView.css'
import Factory from '../Game/Factory';
import ItemsCraftView from './ItemsCraftView';
import { ExchangeDirection } from '../Game/ItemStack';

interface IFactoryProps {
    factory: Factory,
    onClickEnter: () => void
}

export default class FactoryCardView extends React.Component<IFactoryProps> {
    render() {
        var importStacks = this.props.factory.inventory.getItemStackList().filter((itemStacks) => itemStacks.exchangeDirection === ExchangeDirection.import);
        var exportStacks = this.props.factory.inventory.getItemStackList().filter((itemStacks) => itemStacks.exchangeDirection === ExchangeDirection.export);
        return (
            <div className="factory">
                <div className="factory-header">
                    <div className="name">{this.props.factory.pattern ? this.props.factory.pattern.name : "Factory"}</div>
                    <button onClick={() => console.log("click")} className="btn btn-primary btn-modify"><i className="fas fa-edit fa-xs"></i></button>
                </div>

                <div className="factory-wrapper">
                    <ItemsCraftView itemStacks={importStacks} />
                    <div>
                        <div className="arrow"><i className="fas fa-arrow-right fa-10px"></i></div>
                        <div className="fbtn-wrapper">
                            <button className="btn btn-primary" onClick={() => this.props.onClickEnter()}>Enter</button>
                            <button className="btn btn-secondary btn-save" onClick={() => console.log("TODO: Save")}>Save</button> {/*TODO*/}
                            <button className="btn btn-danger btn-destroy" onClick={() => this.props.factory.destroy()}><i className="fas fa-trash fa-xs"></i></button> {/*TODO*/}
                        </div>
                    </div>
                    <ItemsCraftView itemStacks={exportStacks} />
                </div>
            </div>
        );
    }
}