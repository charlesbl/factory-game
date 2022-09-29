import React from 'react';
import { notImplemented } from '..';
import '../css/FactoryCardView.css'
import Factory from '../Game/Factory';
import ItemsCraftView from './IngredientsView';

interface IFactoryProps {
    factory: Factory,
    onClickEnter: () => void
}

export default class FactoryCardView extends React.Component<IFactoryProps> {
    render() {
        return (
            <div className="factory">
                <div className="factory-header">
                    <div className="name">"Factory"</div>
                    {/*TODO*/}<button onClick={() => notImplemented()} className="btn btn-primary btn-modify"><i className="fas fa-edit fa-xs"></i></button>
                </div>

                <div className="factory-wrapper">
                    <div>
                        <div className="arrow"><i className="fas fa-arrow-right fa-10px"></i></div>
                        <div className="fbtn-wrapper">
                            <button className="btn btn-primary" onClick={() => this.props.onClickEnter()}>Enter</button>
                            <button className="btn btn-danger btn-destroy" onClick={() => this.props.factory.destroy()}><i className="fas fa-trash fa-xs"></i></button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}