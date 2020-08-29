import React from 'react';
import FactoryView from './FactoryView';
import IBaseProps from './IBaseProps';
import Factory from '../Game/Factory';

interface IGameState {
    selectedFactory: Factory;
}

export default class GameView extends React.Component<IBaseProps, IGameState> {

    constructor(props: Readonly<IBaseProps>) {
        super(props);
        this.state = { selectedFactory: this.props.game.factory };
    }

    changeFactory(factory: Factory) {
        this.setState({
            selectedFactory: factory
        });
    }

    goBack() {
        if (this.state.selectedFactory.topFactory)
            this.changeFactory(this.state.selectedFactory.topFactory);
    }

    render() {
        return (
            <div>
                <span>{this.props.game.money.toFixed(2)}€</span>
                <FactoryView
                    game={this.props.game}
                    factory={this.state.selectedFactory}
                    onSelectedFactory={(factory) => this.changeFactory(factory)}
                    onGoBack={() => this.goBack()} />
            </div>
        );
    }
}